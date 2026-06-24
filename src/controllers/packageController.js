import prisma from '../utils/prisma.js';

async function verifyLocationOwnership(locationId, ownerId) {
  return prisma.location.findFirst({ where: { id: locationId, ownerId } });
}

function validatePackageInput({ type, durationMinutes, priceXaf, dataCapMb, uploadSpeedMbPerSec }) {
  if (!durationMinutes || durationMinutes <= 0) {
    return 'Duration must be greater than 0';
  }
  if (!priceXaf || priceXaf <= 0) {
    return 'Price must be greater than 0';
  }
  if (!uploadSpeedMbPerSec || uploadSpeedMbPerSec <= 0) {
    return 'Upload speed must be greater than 0';
  }
  if (uploadSpeedMbPerSec > 100) {
    return 'Upload speed cannot exceed 100 MB/s';
  }

  if (type === 'DATA_BASED') {
    if (!dataCapMb || dataCapMb <= 0) {
      return 'Download allowance is required for data-based packages';
    }
  }

  if (type === 'TIME_BASED' && dataCapMb != null && dataCapMb <= 0) {
    return 'Data cap must be greater than 0 when set';
  }

  return null;
}

export async function getPackages(req, res, next) {
  try {
    const { locationId } = req.params;
    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const packages = await prisma.package.findMany({
      where: { locationId },
      orderBy: { priceXaf: 'asc' },
    });

    res.json(packages);
  } catch (err) {
    next(err);
  }
}

export async function createPackage(req, res, next) {
  try {
    const { locationId } = req.params;
    const { name, type = 'TIME_BASED', durationMinutes, priceXaf, dataCapMb, uploadSpeedMbPerSec = 1 } = req.body;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Package name is required' });
    }

    if (!['TIME_BASED', 'DATA_BASED'].includes(type)) {
      return res.status(400).json({ error: 'Package type must be TIME_BASED or DATA_BASED' });
    }

    const parsed = {
      type,
      durationMinutes: Number(durationMinutes),
      priceXaf: Number(priceXaf),
      dataCapMb: dataCapMb ? Number(dataCapMb) : null,
      uploadSpeedMbPerSec: Number(uploadSpeedMbPerSec),
    };

    const validationError = validatePackageInput(parsed);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const pkg = await prisma.package.create({
      data: {
        locationId,
        name: name.trim(),
        type: parsed.type,
        durationMinutes: parsed.durationMinutes,
        priceXaf: parsed.priceXaf,
        dataCapMb: parsed.dataCapMb,
        uploadSpeedMbPerSec: parsed.uploadSpeedMbPerSec,
      },
    });

    res.status(201).json(pkg);
  } catch (err) {
    next(err);
  }
}

export async function updatePackage(req, res, next) {
  try {
    const { locationId, packageId } = req.params;
    const { name, type, durationMinutes, priceXaf, dataCapMb, uploadSpeedMbPerSec } = req.body;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const existing = await prisma.package.findFirst({
      where: { id: packageId, locationId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const nextType = type ?? existing.type;
    const nextDuration = durationMinutes !== undefined ? Number(durationMinutes) : existing.durationMinutes;
    const nextPrice = priceXaf !== undefined ? Number(priceXaf) : existing.priceXaf;
    const nextDataCap =
      dataCapMb !== undefined ? (dataCapMb ? Number(dataCapMb) : null) : existing.dataCapMb;
    const nextUploadSpeed =
      uploadSpeedMbPerSec !== undefined
        ? Number(uploadSpeedMbPerSec)
        : existing.uploadSpeedMbPerSec;

    const validationError = validatePackageInput({
      type: nextType,
      durationMinutes: nextDuration,
      priceXaf: nextPrice,
      dataCapMb: nextDataCap,
      uploadSpeedMbPerSec: nextUploadSpeed,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const updated = await prisma.package.update({
      where: { id: packageId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(type !== undefined && { type: nextType }),
        durationMinutes: nextDuration,
        priceXaf: nextPrice,
        dataCapMb: nextDataCap,
        uploadSpeedMbPerSec: nextUploadSpeed,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deactivatePackage(req, res, next) {
  try {
    const { locationId, packageId } = req.params;

    const location = await verifyLocationOwnership(locationId, req.owner.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const existing = await prisma.package.findFirst({
      where: { id: packageId, locationId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const updated = await prisma.package.update({
      where: { id: packageId },
      data: { isActive: false },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
